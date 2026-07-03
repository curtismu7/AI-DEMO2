import { render, screen, fireEvent, act } from "@testing-library/react";
import TokenChainTraceRail from "../TokenChainTraceRail";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../ClaimDetailsModal", () => ({
  default: ({ isOpen, tokenType }) =>
    isOpen ? <div data-testid="claims-modal">{tokenType}</div> : null,
}));
vi.mock("../TokenLegendModal", () => ({
  default: ({ isOpen }) => (isOpen ? <div data-testid="legend-modal" /> : null),
}));

beforeEach(() => tokenChainTraceStore.reset());

test("renders header, chain line, and all 11 collapsed steps by default", () => {
  render(<TokenChainTraceRail />);
  expect(screen.getByText(/Token Chain/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /legend/i })).toBeInTheDocument();
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
