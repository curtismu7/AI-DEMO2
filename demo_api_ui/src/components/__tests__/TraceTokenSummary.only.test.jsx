import { render, screen, fireEvent } from "@testing-library/react";
import TraceTokenSummary from "../TraceTokenSummary";

const EVENTS = [
  { id: "user-token", label: "User Token", claims: { sub: "u1", scope: "read" } },
  { id: "exchanged-token", label: "Delegated Token",
    claims: { sub: "u1", scope: "write", act: { sub: "agent-001" } } },
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
