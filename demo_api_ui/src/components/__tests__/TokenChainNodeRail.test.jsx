import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TokenChainNodeRail, { SPEEDS } from "../TokenChainNodeRail";

const STEPS = [
  { id: "signin", title: "Sign-in — User Token acquired", lane: "PINGONE", status: "done", detail: { kv: [["scope", "read write"]] } },
  { id: "exchange", title: "Token exchange — delegation", lane: "BFF", status: "done", detail: { kv: [["act", "agent-001"]] } },
  { id: "stepup", title: "Step-up required — HITL / MFA", lane: "AUTHZ", status: "notinpath", detail: {} },
  { id: "mcp", title: "MCP server — tool executes", lane: "MCP", status: "pending", detail: {} },
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
    expect(document.querySelectorAll(".tcnr-node")).toHaveLength(4);
    // terse id-keyed labels, so getByText on a card title stays unambiguous
    expect(screen.getByText("Exchange")).toBeInTheDocument();
    expect(screen.getByText("Step-up")).toBeInTheDocument();
    expect(screen.queryByText(/Token exchange — delegation/)).toBeNull();
  });

  it("shows the first kv pair a step produced as its headline fact", () => {
    render(<TokenChainNodeRail steps={STEPS} activeId={null} onSelect={() => {}} />);
    expect(screen.getByText(/act agent-001/)).toBeInTheDocument();
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
    render(<TokenChainNodeRail steps={STEPS} activeId="mcp" onSelect={onSelect} />);

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
