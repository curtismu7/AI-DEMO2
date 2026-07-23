import { render, screen, fireEvent } from "@testing-library/react";
import TraceTokenSummary from "../TraceTokenSummary";

const EVENTS = [
  { id: "user-token", label: "User Token", claims: { sub: "u1", scope: "read" } },
  { id: "exchanged-token", label: "Delegated Token",
    claims: { sub: "u1", scope: "write", act: { sub: "agent-001" } } },
];

const TWO_EX_EVENTS = [
  { id: "user-token", label: "User Token", claims: { sub: "u1", scope: "read write" } },
  { id: "two-ex-agent-actor", label: "Agent Actor Token", claims: { sub: "agent-cc", scope: "agent:invoke" } },
  { id: "two-ex-exchange1", label: "Agent Exchanged Token",
    claims: { sub: "u1", scope: "agent:invoke read", act: { sub: "agent-cc" } } },
  { id: "two-ex-mcp-actor", label: "MCP Actor Token", claims: { sub: "mcp-cc", scope: "mcp:invoke" } },
  { id: "two-ex-final-token", label: "Final MCP Token",
    claims: { sub: "u1", scope: "write", act: { sub: "mcp-cc", act: { sub: "agent-cc" } } } },
];

test("only='mcp' renders just the delegated token card", () => {
  render(<TraceTokenSummary tokenEvents={EVENTS} onInspect={() => {}} only="mcp" />);
  fireEvent.click(screen.getByText(/Token Summary/).closest("summary"));
  expect(screen.getByText("Delegated Token")).toBeInTheDocument();
  expect(screen.queryByText("User Token")).not.toBeInTheDocument();
  expect(screen.getByText(/Token Summary/).closest("details").querySelector(".tctr-count").textContent).toBe("1");
});

test("no 'only' renders all cards (default behavior)", () => {
  render(<TraceTokenSummary tokenEvents={EVENTS} onInspect={() => {}} />);
  fireEvent.click(screen.getByText(/Token Summary/).closest("summary"));
  expect(screen.getByText("User Token")).toBeInTheDocument();
  expect(screen.getByText("Delegated Token")).toBeInTheDocument();
});

test("2-exchange run lists every token in Token Summary", () => {
  render(<TraceTokenSummary tokenEvents={TWO_EX_EVENTS} onInspect={() => {}} />);
  fireEvent.click(screen.getByText(/Token Summary/).closest("summary"));
  expect(screen.getByText("User Token")).toBeInTheDocument();
  expect(screen.getByText("Agent Actor Token")).toBeInTheDocument();
  expect(screen.getByText("Agent Exchanged Token")).toBeInTheDocument();
  expect(screen.getByText("MCP Actor Token")).toBeInTheDocument();
  expect(screen.getByText("Final MCP Token")).toBeInTheDocument();
  expect(screen.getByText(/Token Summary/).closest("details").querySelector(".tctr-count").textContent).toBe("5");
});

test("only='mcp' on 2-exchange shows just the final delegated token", () => {
  render(<TraceTokenSummary tokenEvents={TWO_EX_EVENTS} onInspect={() => {}} only="mcp" />);
  fireEvent.click(screen.getByText(/Token Summary/).closest("summary"));
  expect(screen.getByText("Final MCP Token")).toBeInTheDocument();
  expect(screen.queryByText("User Token")).not.toBeInTheDocument();
  expect(screen.queryByText("MCP Actor Token")).not.toBeInTheDocument();
  expect(screen.getByText(/Token Summary/).closest("details").querySelector(".tctr-count").textContent).toBe("1");
});
