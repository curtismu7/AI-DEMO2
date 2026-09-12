// The slow-mode reveal is a counter walked by a timer, and where that counter
// STARTS is the whole bug surface: a presenter turns slow mode on after a run
// has already finished, so the counter is sitting at the end of the trace and
// the timer never arms. The reveal then silently does nothing.
import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const STEPS = [
  { id: "s1", lane: "BROWSER", title: "Sign-in — User Token acquired", status: "done" },
  { id: "s2", lane: "PINGONE", title: "Chatbot — prompt sent", status: "done" },
  { id: "s3", lane: "AGENT", title: "Agent service receives request", status: "done" },
];

vi.mock("../../services/tokenChainTrace/tokenChainTraceStore", () => ({
  tokenChainTraceStore: {
    getState: () => ({ steps: STEPS }),
    subscribe: () => () => {},
  },
}));

import SequenceReelDiagram from "../SequenceReelDiagram";

const DEFAULT_MS = 2600;
const noop = () => {};

describe("SequenceReelDiagram slow-mode reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom leaves this off SVG elements; the component scrolls the active step.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const drawnSteps = (c) => c.querySelectorAll('g[role="button"]').length;

  it("rewinds to the first step when slow mode is switched on over a finished trace", () => {
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    expect(drawnSteps(container)).toBe(STEPS.length);

    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    expect(drawnSteps(container)).toBe(0);

    act(() => vi.advanceTimersByTime(DEFAULT_MS));
    expect(drawnSteps(container)).toBe(1);

    act(() => vi.advanceTimersByTime(DEFAULT_MS));
    expect(drawnSteps(container)).toBe(2);

    act(() => vi.advanceTimersByTime(DEFAULT_MS));
    expect(drawnSteps(container)).toBe(STEPS.length);
  });

  it("keeps the toolbar mounted at zero revealed steps", () => {
    // Otherwise the rewind swaps the whole diagram for the empty-state
    // placeholder and takes the button to turn slow mode back off with it.
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);

    expect(drawnSteps(container)).toBe(0);
    expect(container.querySelector(".srd-toolbar")).not.toBeNull();
    expect(container.querySelector(".srd-empty")).toBeNull();
  });

  it("holds the lane cast and canvas width steady across the reveal", () => {
    // Deriving either from the revealed slice re-flows the columns mid-reveal.
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    const full = container.querySelector("svg").getAttribute("viewBox").split(" ")[2];

    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    const widthAt = () => container.querySelector("svg").getAttribute("viewBox").split(" ")[2];
    const lanesAt = () => container.querySelectorAll("rect.srd-actor-box").length;

    expect(widthAt()).toBe(full);
    expect(lanesAt()).toBe(3);

    act(() => vi.advanceTimersByTime(DEFAULT_MS));
    expect(widthAt()).toBe(full);
    expect(lanesAt()).toBe(3);
  });
});
