import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TokenChainNodeRail, { SPEEDS } from "../TokenChainNodeRail";

const STEPS = [
  { id: "signin", title: "Sign-in — User Token acquired", lane: "PINGONE", status: "done", detail: { kv: [["scope", "read write"]] } },
  { id: "exchange", title: "Token exchange — delegation", lane: "BFF", status: "done", detail: { kv: [["act", "agent-001"]] } },
  { id: "stepup", title: "Step-up required — HITL / MFA", lane: "AUTHZ", status: "notinpath", detail: {} },
  { id: "mcp", title: "MCP server — tool executes", lane: "MCP", status: "pending", detail: {} },
  { id: "authorize", title: "PingOne Authorize — policy decision", lane: "AUTHZ", status: "active", detail: {} },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TokenChainNodeRail", () => {
  it("renders nothing when the run has produced no steps (Live mode before a run)", () => {
    const { container } = render(<TokenChainNodeRail steps={[]} activeId={null} onSelect={() => {}} />);
    expect(container.querySelector(".tcnr")).toBeNull();
  });

  it("renders one node per step, labelled without repeating the card's full title", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    expect(document.querySelectorAll(".tcnr-node")).toHaveLength(STEPS.length);
    // terse id-keyed labels, so getByText on a card title stays unambiguous
    expect(screen.getByText("Exchange")).toBeInTheDocument();
    expect(screen.getByText("Step-up")).toBeInTheDocument();
    expect(screen.queryByText(/Token exchange — delegation/)).toBeNull();
  });

  // The node fact describes what the hop CHANGED. The act claim appearing is the
  // delegation itself, so it leads with a "+" rather than reading as a field the
  // step merely carries.
  it("leads with the act claim a step added", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText(/act \+agent-001/)).toBeInTheDocument();
  });

  // The map card is ~130px wide. It used to render every `before` scope inline,
  // which on a real exchange produced one unreadable run of text. It now states
  // the shape of the change; the chip-by-chip diff lives in the detail panel.
  const exchangeStep = (before, after) => [{
    id: "exchange", title: "Token exchange", lane: "BFF", status: "done",
    detail: { scopeDiff: { before, after } },
  }];

  it("names the narrowing rather than listing every scope", () => {
    render(
      <TokenChainNodeRail
        steps={exchangeStep(
          ["ai:agent:read", "read", "transfer", "openid", "profile", "offline_access", "write", "email", "mortgage:read"],
          ["read", "transfer", "write"],
        )}
        activeId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("scope narrowed 9 → 3")).toBeInTheDocument();
    // The old rendering concatenated the scope names with no separator.
    expect(screen.queryByText(/ai:agent:readread/)).not.toBeInTheDocument();
  });

  it("keeps the full before/after reachable on hover", () => {
    render(<TokenChainNodeRail steps={exchangeStep(["read", "write"], ["write"])} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("scope narrowed 2 → 1")).toHaveAttribute(
      "title",
      "before: read write\nafter: write",
    );
  });

  it("does not claim a narrowing when nothing was dropped", () => {
    render(<TokenChainNodeRail steps={exchangeStep(["read"], ["read"])} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("scope unchanged")).toBeInTheDocument();
  });

  it("reports a widened exchange as a change, never as a narrowing", () => {
    render(<TokenChainNodeRail steps={exchangeStep(["read"], ["read", "write"])} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("scope 1 → 2")).toBeInTheDocument();
    expect(screen.queryByText(/narrowed/)).not.toBeInTheDocument();
  });

  it("says a finished transport hop changed nothing, but never says it of one still running", () => {
    const bare = { id: "gateway", title: "Gateway", lane: "GATEWAY", detail: {} };
    const { rerender } = render(
      <TokenChainNodeRail steps={[{ ...bare, status: "done" }]} activeId={null} onSelect={() => {}} />,
    );
    expect(screen.getByText("no token change")).toBeInTheDocument();

    rerender(<TokenChainNodeRail steps={[{ ...bare, status: "active" }]} activeId={null} onSelect={() => {}} />);
    expect(screen.queryByText("no token change")).toBeNull();
    expect(screen.getByText("in flight")).toBeInTheDocument();
  });

  it("never says done for a hop that is still in flight", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    // "active" is a real status (exchange/authorize mid-run). It must read as
    // in flight, not as a completed step.
    expect(screen.getByText("in flight")).toBeInTheDocument();
    const authorize = screen.getByText("Authorize").closest(".tcnr-node");
    expect(authorize.className).toContain("tcnr-node--active");
    expect(authorize.className).not.toContain("tcnr-node--sel");
  });

  it("keeps the selected node distinct from a node whose status is active", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId="exchange" onSelect={() => {}} />);
    const selected = screen.getByText("Exchange").closest(".tcnr-node");
    const inFlight = screen.getByText("Authorize").closest(".tcnr-node");
    expect(selected.className).toContain("tcnr-node--sel");
    expect(inFlight.className).not.toContain("tcnr-node--sel");
    expect(document.querySelectorAll(".tcnr-node--sel")).toHaveLength(1);
  });

  it("marks steps that did not run rather than implying they succeeded", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText("not in this path")).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
  });

  it("selects a step when its node is clicked", async () => {
    const onSelect = vi.fn();
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Exchange"));
    expect(onSelect).toHaveBeenCalledWith("exchange");
  });

  it("persists the density toggle", async () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(window.localStorage.getItem("tctr_node_density")).toBe("compact");
    expect(document.querySelector(".tcnr").getAttribute("data-density")).toBe("compact");
  });

  it("defaults to the fastest walk-through speed", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByLabelText("Walk-through speed")).toHaveValue(String(SPEEDS[0].ms));
  });

  it("Run advances one step per tick", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<TokenChainNodeRail steps={STEPS} activeId="signin" onSelect={onSelect} />);

    act(() => {
      screen.getByRole("button", { name: /Run/ }).click();
    });
    act(() => {
      vi.advanceTimersByTime(SPEEDS[0].ms);
    });

    expect(onSelect).toHaveBeenCalledWith("exchange");
  });

  it("stops on the last step instead of looping back to the start", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    // already parked on the final step
    render(<TokenChainNodeRail steps={STEPS} activeId="authorize" onSelect={onSelect} />);

    act(() => {
      // at the end the control offers Replay, which restarts from step one
      screen.getByRole("button", { name: /Replay/ }).click();
    });
    expect(onSelect).toHaveBeenCalledWith("signin");

    onSelect.mockClear();
    act(() => {
      vi.advanceTimersByTime(SPEEDS[0].ms * 6);
    });
    // it never wraps past the end back onto step one
    expect(onSelect.mock.calls.every(([id]) => id !== "signin")).toBe(true);
  });
});
