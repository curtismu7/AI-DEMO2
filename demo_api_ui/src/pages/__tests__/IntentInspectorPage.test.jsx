// The Intent Inspector exists to show one thing an operator cannot otherwise
// see: whether the action an agent is attempting is the action the user
// consented to. Everything below pins the honesty rules from the page header —
// the verdict belongs to PingOne Authorize, an endpoint that is not backed by
// the Agent Intent Governance policy set must say so rather than pass its
// unrelated PERMIT off as an intent decision, and a disagreement between the
// local comparison view and the verdict is surfaced, not smoothed over.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import IntentInspectorPage from "../IntentInspectorPage";
import { INTENT_DRIFT_SCENARIOS } from "../../config/intentDriftScenarios";

const ENDPOINTS = [
  { id: "ep-intent", name: "Agent Intent Governance" },
  { id: "ep-mcp", name: "MCP Delegation" },
];

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("../../services/apiClient", () => ({
  default: {
    get: (...args) => mockGet(...args),
    post: (...args) => mockPost(...args),
  },
}));

/** A decision carrying an intent-* statement — i.e. the policy set answered. */
const intentDecision = (decision, code) => ({
  data: {
    ok: true,
    decision,
    engine: "pingone",
    raw: { decision, statements: [{ code, name: code }] },
  },
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue({ data: { endpoints: ENDPOINTS } });
});

async function renderAndSelectEndpoint() {
  render(<IntentInspectorPage />);
  await waitFor(() => expect(screen.getByRole("option", { name: "Agent Intent Governance" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Decision endpoint/i), { target: { value: "ep-intent" } });
}

describe("IntentInspectorPage", () => {
  it("lists every catalogued scenario", async () => {
    render(<IntentInspectorPage />);
    for (const s of INTENT_DRIFT_SCENARIOS) {
      expect(screen.getByRole("button", { name: s.label })).toBeInTheDocument();
    }
  });

  it("loads a scenario's grant and request into the form", async () => {
    render(<IntentInspectorPage />);
    fireEvent.click(screen.getByRole("button", { name: /Amount inflated/i }));
    // The grant still caps at 100 while the attempt is 5000 — same tool, drifted
    // argument, which a permitted_tools check cannot see.
    expect(screen.getByLabelText(/Granted max amount/i)).toHaveValue(100);
    expect(screen.getByLabelText(/Attempted amount/i)).toHaveValue(5000);
    expect(screen.getByLabelText(/Attempted action/i)).toHaveValue("create_transfer");
  });

  it("refuses to evaluate without an endpoint rather than guessing one", async () => {
    render(<IntentInspectorPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Evaluate$/i }));
    expect(await screen.findByText(/Choose the decision endpoint/i)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("renders the PingOne Authorize verdict, not its own", async () => {
    mockPost.mockResolvedValue(intentDecision("DENY", "intent-amount-drift"));
    await renderAndSelectEndpoint();
    fireEvent.click(screen.getByRole("button", { name: /Amount inflated/i }));
    fireEvent.change(screen.getByLabelText(/Decision endpoint/i), { target: { value: "ep-intent" } });
    fireEvent.click(screen.getByRole("button", { name: /^Evaluate$/i }));

    expect(await screen.findByText(/PingOne Authorize decision:/i)).toBeInTheDocument();
    // Scoped to the Statements line — the expectation line names the same code,
    // and conflating the two would let a page that only echoes the expectation
    // pass this test.
    expect(screen.getByText("Statements:").closest("p")).toHaveTextContent("intent-amount-drift");
    expect(mockPost).toHaveBeenCalledWith(
      "/api/authorize/evaluate-endpoint",
      expect.objectContaining({ endpointId: "ep-intent" }),
    );
  });

  // THE load-bearing case. Fired at an endpoint backed by some other policy, the
  // call still returns a confident verdict. Presenting that as an intent decision
  // would be the single most misleading thing this page could do.
  it("warns when the endpoint returned no intent-* statement", async () => {
    mockPost.mockResolvedValue({
      data: {
        ok: true,
        decision: "PERMIT",
        engine: "pingone",
        raw: { decision: "PERMIT", statements: [{ code: "mcp-tool-authorized" }] },
      },
    });
    await renderAndSelectEndpoint();
    fireEvent.click(screen.getByRole("button", { name: /^Evaluate$/i }));

    expect(
      await screen.findByText(/not backed by the Agent Intent Governance policy set/i),
    ).toBeInTheDocument();
  });

  it("flags a verdict that disagrees with the scenario's expectation", async () => {
    // Drift scenario that the deployed policy permits — the policy is stale or
    // the wrong version. Surfaced, never reconciled silently.
    mockPost.mockResolvedValue(intentDecision("PERMIT", "intent-within-grant"));
    await renderAndSelectEndpoint();
    fireEvent.click(screen.getByRole("button", { name: /Payee substituted/i }));
    fireEvent.change(screen.getByLabelText(/Decision endpoint/i), { target: { value: "ep-intent" } });
    fireEvent.click(screen.getByRole("button", { name: /^Evaluate$/i }));

    expect(await screen.findByText(/disagrees with this scenario/i)).toBeInTheDocument();
  });

  it("marks the drifted dimension in the comparison view", async () => {
    render(<IntentInspectorPage />);
    fireEvent.click(screen.getByRole("button", { name: /Payee substituted/i }));
    fireEvent.click(screen.getByRole("button", { name: "Comparison" }));

    const payeeRow = screen.getByText("Payee").closest("tr");
    expect(payeeRow).toHaveTextContent("acme-utilities");
    expect(payeeRow).toHaveTextContent("attacker-account");
    expect(payeeRow).toHaveTextContent("intent-payee-drift");
  });

  it("treats a read with no grant as out of scope for intent governance", async () => {
    render(<IntentInspectorPage />);
    fireEvent.click(screen.getByRole("button", { name: /Read with no grant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Comparison" }));

    // Not governed => no dimension is marked as violating, even though the grant
    // fields are empty and therefore differ from the attempted action.
    const actionRow = screen.getByText("Action").closest("tr");
    expect(actionRow).toHaveTextContent("view_balance");
    expect(actionRow).not.toHaveTextContent("❌");
  });

  it("surfaces a failure to list endpoints instead of rendering an empty picker", async () => {
    mockGet.mockRejectedValue({ response: { data: { message: "admin session required" } } });
    render(<IntentInspectorPage />);
    expect(await screen.findByText(/admin session required/i)).toBeInTheDocument();
  });
});
