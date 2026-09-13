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

// A store the tests can drive: set `store.state` and call `emit` to simulate a
// new run starting or a live run adding steps.
const store = vi.hoisted(() => ({ state: null, listeners: new Set() }));
vi.mock("../../services/tokenChainTrace/tokenChainTraceStore", () => ({
  tokenChainTraceStore: {
    getState: () => store.state,
    subscribe: (fn) => {
      store.listeners.add(fn);
      return () => store.listeners.delete(fn);
    },
  },
}));

import SequenceReelDiagram from "../SequenceReelDiagram";

const DEFAULT_MS = 2600;
const noop = () => {};

let scrollIntoViewSpy;

describe("SequenceReelDiagram slow-mode reveal", () => {
  beforeEach(() => {
    // Default: a finished run whose three steps all happened.
    store.state = { steps: STEPS, trace: { runId: 1, outcome: "ok" } };
    store.listeners.clear();
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

  it("draws the lane cast again under the last row, and moves it down with the reveal", () => {
    const { container, rerender } = render(
      <SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />,
    );
    const labels = (sel) => [...container.querySelectorAll(sel)].map((t) => t.textContent);
    expect(labels("text.srd-actor-label--footer")).toEqual(labels("text.srd-actor-label:not(.srd-actor-label--footer)"));
    expect(container.querySelectorAll("rect.srd-actor-box--footer")).toHaveLength(3);

    const footerY = () => Number(container.querySelector("rect.srd-actor-box--footer").getAttribute("y"));
    const lowestRowY = () => {
      let max = -Infinity;
      for (const g of container.querySelectorAll('g[role="button"]')) {
        for (const el of g.querySelectorAll("line, rect")) {
          max = Math.max(max, Number(el.getAttribute("y1") ?? el.getAttribute("y")), Number(el.getAttribute("y2") ?? -Infinity));
        }
      }
      return max;
    };

    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    tick();
    const first = footerY();
    expect(first).toBeGreaterThan(lowestRowY());
    tick();
    expect(footerY()).toBeGreaterThan(first);
    expect(footerY()).toBeGreaterThan(lowestRowY());
  });

  // A layout where the scroller is 600px tall with control rows pinned over its
  // top 40px and bottom 40px. jsdom does no layout, so without stubs every rect
  // is 0x0 and the follow never moves — the assertions would pass vacuously.
  const withBand = ({ step, footer }) => {
    const scrollTo = vi.fn();
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(scrollTo);
    const rect = (top, bottom) => ({ top, bottom, height: bottom - top, left: 0, right: 800, width: 800 });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      const cls = String(this.getAttribute?.("class") || "");
      if (cls.includes("srd-toolbar--top")) return rect(0, 40);
      if (cls.includes("srd-toolbar--bottom")) return rect(560, 600);
      if (cls.includes("srd-actor-box--footer")) return rect(footer[0], footer[1]);
      if (cls.split(" ").includes("srd-root")) return rect(0, 600);
      if (this.getAttribute?.("role") === "button") return rect(step[0], step[1]);
      return rect(0, 0);
    });
    return () => scrollTo.mock.calls.map(([a]) => a).filter((a) => a && "top" in a);
  };

  it("brings the newest step and the footer out from under the pinned bottom row", () => {
    // Step bottom 520 and footer bottom 580 are both inside the scroller (600),
    // but the bottom row covers 560-600: measuring against the scroller alone
    // left the footer under the row and never scrolled.
    const verticalCalls = withBand({ step: [500, 520], footer: [530, 580] });
    render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
    expect(verticalCalls().at(-1)?.top).toBe(20);
  });

  it("does not chase the footer past a mid-trace active step", () => {
    // The footer is far below a mid-trace step; scrolling to it would push the
    // step the viewer is following out of view.
    const prior = STEPS[0].status;
    STEPS[0].status = "active";
    try {
      const verticalCalls = withBand({ step: [100, 120], footer: [530, 580] });
      render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
      expect(verticalCalls()).toHaveLength(0);
    } finally {
      STEPS[0].status = prior;
    }
  });

  const emit = (next) =>
    act(() => {
      store.state = next;
      store.listeners.forEach((fn) => fn(next));
    });

  const step = (id, lane, status, title = id) => ({ id, lane, title, status });

  it("draws nothing until a run has happened beyond the always-on rows", () => {
    // What a fresh page load produces: the browser step is always done, sign-in
    // is carried over, and every other step is still pending.
    store.state = {
      steps: [
        step("website", "BROWSER", "done"),
        step("signin", "PINGONE", "done"),
        step("prompt", "CHAT", "pending"),
        step("agent", "AGENT", "pending"),
      ],
      trace: { runId: null, outcome: null },
    };
    const { container } = render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
    expect(drawnSteps(container)).toBe(0);
    expect(container.querySelector(".srd-empty")).not.toBeNull();
  });

  it("draws only steps that happened, including failures", () => {
    store.state = {
      steps: [
        step("website", "BROWSER", "done"),
        step("signin", "PINGONE", "done"),
        step("prompt", "CHAT", "done"),
        step("agent", "AGENT", "pending"),
        step("llm", "LLM", "notinpath"),
        step("api-key-swap", "GATEWAY", "skipped"),
        step("gateway", "GATEWAY", "error"),
      ],
      trace: { runId: 1, outcome: "error" },
    };
    const { container } = render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
    const titles = [...container.querySelectorAll('g[role="button"] text')].map((t) => t.textContent);
    expect(drawnSteps(container)).toBe(4);
    expect(titles).toContain("gateway");
    for (const hidden of ["agent", "llm", "api-key-swap"]) expect(titles).not.toContain(hidden);
  });

  it("does not start a narration on mount when slow mode is already on", () => {
    // Slow mode comes back from localStorage, so it is on at page load. Loading
    // the page must not replay the last trace.
    const { container } = render(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    expect(drawnSteps(container)).toBe(STEPS.length);
    tick(STEPS.length + 2);
    expect(drawnSteps(container)).toBe(STEPS.length);
    expect(btn(container, "Replay")).toBeTruthy();
  });

  it("clears the previous flow when a new run starts, and narrates it in slow mode", () => {
    const { container } = render(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    expect(drawnSteps(container)).toBe(STEPS.length);

    emit({ steps: [step("n1", "BROWSER", "done", "New run step")], trace: { runId: 2, outcome: null } });
    expect(drawnSteps(container)).toBe(0);
    const titles = () => [...container.querySelectorAll('g[role="button"] text')].map((t) => t.textContent);
    expect(titles()).not.toContain(STEPS[2].title);

    tick();
    expect(drawnSteps(container)).toBe(1);
    expect(titles()).toContain("New run step");
  });

  it("keeps playing when it catches up with a run that is still going", () => {
    store.state = { steps: STEPS, trace: { runId: 1, outcome: null } };
    const { container, rerender } = render(<SequenceReelDiagram slowMode={false} onToggleSlowMode={noop} />);
    rerender(<SequenceReelDiagram slowMode onToggleSlowMode={noop} />);
    tick(STEPS.length + 2);
    expect(drawnSteps(container)).toBe(STEPS.length);
    // Caught up, not finished: still following, not offering a replay.
    expect(btn(container, "Pause")).toBeTruthy();
    expect(btn(container, "Replay")).toBeFalsy();

    emit({ steps: [...STEPS, step("s4", "MCP", "done", "Fourth")], trace: { runId: 1, outcome: null } });
    tick();
    expect(drawnSteps(container)).toBe(4);

    emit({ steps: [...STEPS, step("s4", "MCP", "done", "Fourth")], trace: { runId: 1, outcome: "ok" } });
    expect(btn(container, "Replay")).toBeTruthy();
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
    const lanesAt = () => container.querySelectorAll("rect.srd-actor-box:not(.srd-actor-box--footer)").length;

    expect(widthAt()).toBe(full);
    expect(lanesAt()).toBe(3);

    act(() => vi.advanceTimersByTime(DEFAULT_MS));
    expect(widthAt()).toBe(full);
    expect(lanesAt()).toBe(3);
  });
});
