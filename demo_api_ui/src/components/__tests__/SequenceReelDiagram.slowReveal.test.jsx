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

let scrollIntoViewSpy;

describe("SequenceReelDiagram slow-mode reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom leaves this off SVG elements; the component scrolls the active step.
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("follows the active step without scrollIntoView", () => {
    // scrollIntoView moves every scrollable ancestor on BOTH axes, and
    // .srd-scroll is overflow-x:auto — so following a late step drags the
    // diagram sideways and cuts off the first lanes. jsdom has no layout, so
    // asserting the resulting offsets would be vacuous; asserting the two-axis
    // API is never reached is the part that actually regresses.
    const { rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    act(() => vi.advanceTimersByTime(DEFAULT_MS * 3));
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  // jsdom does no layout, so every rect is 0x0 and the follow computes a zero
  // delta — an unstubbed assertion here would pass whether or not the feature
  // exists. Stub the two rects the effect reads so the delta is real.
  const withLayout = ({ stepLeft, stepRight, viewLeft = 0, viewRight = 800 }) => {
    // HTMLElement.prototype, not Element.prototype: jsdom leaves scrollTo
    // undefined on Element but defines it on HTMLElement, so a stub on Element
    // is shadowed for any <div> and silently never fires.
    const scrollTo = vi.fn();
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(scrollTo);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      const cls = String(this.getAttribute?.("class") || this.className?.baseVal || this.className || "");
      if (cls.includes("srd-scroll"))
        return { left: viewLeft, right: viewRight, width: viewRight - viewLeft, top: 0, bottom: 600, height: 600 };
      if (this.getAttribute?.("role") === "button")
        return { left: stepLeft, right: stepRight, width: stepRight - stepLeft, top: 0, bottom: 20, height: 20 };
      return { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0 };
    });
    return scrollTo;
  };

  it("scrolls right to keep the revealed step on screen in slow mode", () => {
    const scrollTo = withLayout({ stepLeft: 1200, stepRight: 1400 });
    const { rerender } = render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    act(() => vi.advanceTimersByTime(DEFAULT_MS));

    const horizontal = scrollTo.mock.calls.map(([a]) => a).filter((a) => a && "left" in a);
    expect(horizontal.length).toBeGreaterThan(0);
    // step.right 1400 past view.right 800, minus a 24px gutter.
    expect(horizontal.at(-1).left).toBe(624);
  });

  it("never scrolls horizontally when slow mode is off", () => {
    // This is what keeps a finished trace anchored at the first lane on open.
    const scrollTo = withLayout({ stepLeft: 1200, stepRight: 1400 });
    render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
    act(() => vi.advanceTimersByTime(DEFAULT_MS * 3));
    expect(scrollTo.mock.calls.map(([a]) => a).filter((a) => a && "left" in a)).toHaveLength(0);
  });

  const btn = (c, label) =>
    [...c.querySelectorAll(".srd-toolbar button")].find((b) => b.textContent.trim() === label);

  // One act() per interval. The next timeout is only scheduled once React has
  // re-rendered, so advancing N intervals in a single act() fires exactly one.
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) act(() => vi.advanceTimersByTime(DEFAULT_MS));
  };

  it("halts at the last step instead of running on", () => {
    // Steps can still be arriving from a live run; without the halt the reveal
    // quietly picks them up and keeps moving after the presenter thought it had
    // finished.
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    tick(STEPS.length + 4);

    expect(drawnSteps(container)).toBe(STEPS.length);
    // Offers a replay rather than sitting on "Pause" at a dead end.
    expect(btn(container, "Replay")).toBeTruthy();
    expect(btn(container, "Next").disabled).toBe(true);
  });

  it("steps forward and back by hand, and stops playing when it does", () => {
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    tick();
    expect(drawnSteps(container)).toBe(1);

    act(() => btn(container, "Next").click());
    expect(drawnSteps(container)).toBe(2);
    // Manual stepping pauses, so the timer must not carry it onward.
    expect(btn(container, "Play")).toBeTruthy();
    tick(4);
    expect(drawnSteps(container)).toBe(2);

    act(() => btn(container, "Prev").click());
    expect(drawnSteps(container)).toBe(1);
    act(() => btn(container, "Prev").click());
    expect(drawnSteps(container)).toBe(0);
    expect(btn(container, "Prev").disabled).toBe(true);
  });

  it("replays from the first step when Play is pressed at the end", () => {
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    tick(STEPS.length + 4);
    expect(drawnSteps(container)).toBe(STEPS.length);

    act(() => btn(container, "Replay").click());
    expect(drawnSteps(container)).toBe(0);
    tick();
    expect(drawnSteps(container)).toBe(1);
  });

  it("renders a control row above and below the diagram", () => {
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    expect(container.querySelectorAll(".srd-toolbar")).toHaveLength(2);
    expect(container.querySelector(".srd-toolbar--top")).not.toBeNull();
    expect(container.querySelector(".srd-toolbar--bottom")).not.toBeNull();
    // The bottom row is the one a presenter reaches during a long reveal, so it
    // must carry the transport too, not just the zoom buttons.
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    const bottom = container.querySelector(".srd-toolbar--bottom");
    for (const label of ["Prev", "Next"])
      expect([...bottom.querySelectorAll("button")].some((b) => b.textContent.trim() === label)).toBe(true);
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
