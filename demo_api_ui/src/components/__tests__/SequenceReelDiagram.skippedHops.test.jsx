// A completed Live run collapses the hops that never fired behind a
// "+N hops not in this run" chip, as the token-chain rail does; in flight and
// for handed-in (recorded) steps there is no chip.
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const STEPS = [
  { id: "s1", lane: "BROWSER", title: "Sign-in — User Token acquired", status: "done" },
  { id: "s2", lane: "AGENT", title: "Agent service receives request", status: "done" },
  { id: "s3", lane: "GATEWAY", title: "Agent Gateway", status: "pending", baseId: "gateway" },
  { id: "s4", lane: "MCP", title: "MCP tool call", status: "pending", baseId: "mcp" },
];

const store = vi.hoisted(() => ({ state: null }));
vi.mock("../../services/tokenChainTrace/tokenChainTraceStore", () => ({
  tokenChainTraceStore: { getState: () => store.state, subscribe: () => () => {} },
}));

import SequenceReelDiagram from "../SequenceReelDiagram";

const drawn = (c) => c.querySelectorAll('g[role="button"]').length;

describe("SequenceReelDiagram skipped-hops chip", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("collapses unfired hops behind a chip on a completed run and reveals them greyed", () => {
    store.state = { steps: STEPS, trace: { runId: 1, outcome: "ok", startedAt: 1 } };
    const { container, getByTestId } = render(<SequenceReelDiagram />);
    expect(drawn(container)).toBe(2);
    const chip = getByTestId("srd-skipped-chip");
    expect(chip.textContent).toBe("+ 2 hops not in this run");

    fireEvent.click(chip);
    expect(drawn(container)).toBe(4);
    expect(container.querySelectorAll(".srd-skipped").length).toBe(2);
    expect(getByTestId("srd-skipped-chip").textContent).toBe("− 2 hops not in this run");
  });

  it("shows no chip while the run is still in flight", () => {
    store.state = { steps: STEPS, trace: { runId: 1, startedAt: 1 } };
    const { queryByTestId } = render(<SequenceReelDiagram />);
    expect(queryByTestId("srd-skipped-chip")).toBeNull();
  });

  it("shows no chip for handed-in recorded steps", () => {
    store.state = { steps: [], trace: {} };
    const { queryByTestId } = render(<SequenceReelDiagram externalSteps={STEPS.slice(0, 2)} />);
    expect(queryByTestId("srd-skipped-chip")).toBeNull();
  });
});
