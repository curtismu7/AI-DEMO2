// Render guard for the surface the demo actually shows.
//
// WHY THIS EXISTS
// Five separate times on 2026-08-17 a token-chain feature passed its unit tests,
// emitted correct token events, and was still wrong or invisible on screen:
//
//   - the Agent Gateway's filter stages went into TraceStepCard, which the
//     focus-mode dashboard never mounts (it renders TokenChainFilmstrip +
//     TokenChainNodeRail, and StepDetailPanel as the detail sheet)
//   - the MCP handshake hops only populate on the direct path, so they sat blank
//   - the Exchange hop read "in flight" on finished runs, and the fix for it
//     passed a test that SET outcome:"ok" while live runs leave outcome null
//
// Every one was caught by hand, late, by driving the browser. buildTraceSteps
// tests cannot catch them: they prove the MODEL is right, not that the component
// tree a user looks at renders it. This file drives the real store through the
// real focus-mode components and asserts what ends up in the DOM.
//
// If you add a hop or a detail block, add it here too. A test that only checks
// buildTraceSteps is not evidence that anyone can see your work.
import { render, screen, fireEvent, act } from "@testing-library/react";
import TokenChainFilmstrip from "../TokenChainFilmstrip";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));
vi.mock("../../context/ProofOfEnforcementContext", () => ({
  useProofOfEnforcementOptional: () => null,
}));
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

// A trace shaped like a real gateway-path run: the 401 challenges, the gateway's
// filter chain, and an exchange event that never leaves "waiting" — exactly what
// the live BFF emits.
const GATEWAY_RUN_EVENTS = [
  { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
  { type: "mcp_challenge", phase: "tools/list", method: "tools/list", status: 401, challenged: true,
    url: "https://gw.example/mcp", wwwAuthenticate: 'Bearer realm="PingOne"', realm: "PingOne" },
  { type: "mcp_challenge", phase: "tools/call", method: "tools/call", status: 401, challenged: true,
    url: "https://gw.example/mcp", wwwAuthenticate: 'Bearer realm="PingOne"', realm: "PingOne" },
  { id: "exchanged-token", status: "waiting", claims: { scope: "read", act: { sub: "agent-1" } } },
  { id: "gw-authorize", decision: "PERMIT", tool: "list_orders",
    filterChain: [
      { filter: "McpValidationFilter", result: "passed" },
      { filter: "McpAuditFilter", result: "passed" },
      { filter: "McpProtectionFilter", result: "passed" },
      { filter: "TokenIntrospection", result: "passed" },
      { filter: "P1AZDecision", result: "forwarded", decision: "PERMIT" },
    ],
    lastFilter: "P1AZDecision" },
];

function runGatewayFlow() {
  act(() => tokenChainTraceStore.beginTrace({ prompt: "List my orders" }));
  act(() => tokenChainTraceStore.ingestTokenEvents(GATEWAY_RUN_EVENTS));
}

// Click a node by its rendered text. The node rail shows the SHORT name
// ("Gateway"), not the step title ("Agent Gateway — token validated"), so match
// on the node element itself rather than a title string.
function openNode(re) {
  const node = [...document.querySelectorAll(".tcnr-node")].find((n) => re.test(n.textContent));
  if (!node) throw new Error(`no .tcnr-node matching ${re}; saw: ` +
    [...document.querySelectorAll(".tcnr-node")].map((n) => n.textContent.trim()).join(" | "));
  fireEvent.click(node);
}

beforeEach(() => {
  tokenChainTraceStore.reset();
  localStorage.clear();
});

describe("focus mode renders what the chain claims", () => {
  test("both MCP 401 challenge hops appear as their own nodes", () => {
    render(<TokenChainFilmstrip />);
    runGatewayFlow();
    // Regression target: these are separate round trips and must not collapse
    // back into the authorized hop.
    expect(screen.getAllByText(/tools\/list 401/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/tools\/call 401/).length).toBeGreaterThan(0);
  });

  test("the gateway's filter stages reach the detail sheet, not just the step model", () => {
    render(<TokenChainFilmstrip />);
    runGatewayFlow();
    openNode(/GATEWAYGateway/);
    // .sdp-stage is StepDetailPanel's markup — the shared sheet BOTH rails use.
    // Asserting on the DOM here is the whole point: the first version of this
    // feature lived in TraceStepCard and rendered nowhere in this tree.
    const stages = document.querySelectorAll(".sdp-stage");
    expect(stages.length).toBe(5);
    expect(screen.getByText("MCP protocol validation")).toBeInTheDocument();
    expect(screen.getByText("PingOne Authorize decision")).toBeInTheDocument();
  });

  test("a finished-enough run does not leave the Exchange hop reading 'in flight'", () => {
    render(<TokenChainFilmstrip />);
    runGatewayFlow();
    // gw-authorize proves the exchange completed. outcome is deliberately NEVER
    // set here, because live runs frequently never set it — the bug that made
    // the first fix pass its test and change nothing on screen.
    const inFlight = [...document.querySelectorAll(".tcnr-node")]
      .filter((n) => /Exchange/.test(n.textContent) && /in flight/i.test(n.textContent));
    expect(inFlight).toHaveLength(0);
  });
});


// A run where the model answered from context — no tool call, so no gateway
// evidence and no MCP result. The BFF still emits the exchanged-token event with
// status "waiting", and nothing will ever supersede it.
const NO_TOOL_CALL_EVENTS = [
  { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
  { type: "mcp_challenge", phase: "tools/list", method: "tools/list", status: 401, challenged: true,
    url: "https://gw.example/mcp", wwwAuthenticate: 'Bearer realm="PingOne"', realm: "PingOne" },
  { id: "exchanged-token", status: "waiting", claims: { scope: "read" } },
];

describe("a hop that never ran says so", () => {
  test("Exchange reads 'not required', not 'in flight', when no tool was called", () => {
    render(<TokenChainFilmstrip />);
    act(() => tokenChainTraceStore.beginTrace({ prompt: "show my invoices" }));
    act(() => tokenChainTraceStore.ingestTokenEvents(NO_TOOL_CALL_EVENTS));
    // The reply is what makes the run finished. `outcome` is deliberately never
    // set — live runs stream the reply and leave it null, which is the trap that
    // made the first version of the #1966 fix pass its test and change nothing.
    act(() => tokenChainTraceStore.ingestLlmReply("You have 3 invoices."));

    const exchange = [...document.querySelectorAll(".tcnr-node")]
      .find((n) => /Exchange/.test(n.textContent));
    expect(exchange, "an Exchange node is rendered").toBeTruthy();
    expect(exchange.textContent).toMatch(/not required/);
    expect(exchange.textContent).not.toMatch(/in flight/);
  });

  test("a genuinely in-flight exchange is still reported as in flight", () => {
    render(<TokenChainFilmstrip />);
    act(() => tokenChainTraceStore.beginTrace({ prompt: "show my invoices" }));
    act(() => tokenChainTraceStore.ingestTokenEvents(NO_TOOL_CALL_EVENTS));
    // No reply yet — the run is mid-flight, so the hop must NOT claim it was
    // unnecessary. This is the guard against the fix over-reaching.
    const exchange = [...document.querySelectorAll(".tcnr-node")]
      .find((n) => /Exchange/.test(n.textContent));
    expect(exchange.textContent).toMatch(/in flight/);
    expect(exchange.textContent).not.toMatch(/not required/);
  });
});
