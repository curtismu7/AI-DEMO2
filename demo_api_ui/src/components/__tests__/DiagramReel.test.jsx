import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DiagramReel from "../DiagramReel";
import { buildNodeDetail, buildReelSteps } from "../../utils/diagramReel";

const nodes = [
  { id: "a", label: "Browser", sub: ["the user's tab"] },
  { id: "b", label: "BFF\nsession broker", sub: ["holds the token"] },
  { id: "c", label: "Gateway" },
];
const edges = [
  ["a", "b", "sign in"],
  ["b", "c", "tool call"],
];

describe("buildReelSteps", () => {
  it("makes one numbered step per arrow, with both ends' detail lines", () => {
    const steps = buildReelSteps({ edges, nodes });
    expect(steps.map((s) => [s.n, s.title, s.label])).toEqual([
      [1, "Browser → BFF", "sign in"],
      [2, "BFF → Gateway", "tool call"],
    ]);
    expect(steps[0].lines).toEqual([
      { who: "Browser", text: "the user's tab" },
      { who: "BFF", text: "holds the token" },
    ]);
  });

  it("prefers a details map over a node's own lines, and reads React Flow edges too", () => {
    const steps = buildReelSteps({ edges: [{ source: "a", target: "b", label: "x" }], nodes, details: { a: "written detail" } });
    expect(steps[0].lines[0]).toEqual({ who: "Browser", text: "written detail" });
  });

  it("builds a node detail (empty lines when there is nothing to say)", () => {
    expect(buildNodeDetail(nodes[0])).toEqual({ title: "Browser", lines: [{ who: "", text: "the user's tab" }] });
    expect(buildNodeDetail(nodes[2]).lines).toEqual([]);
  });
});

describe("DiagramReel", () => {
  const steps = buildReelSteps({ edges, nodes });
  const stepper = (over = {}) => ({ step: -1, goTo: vi.fn(), ...over });

  it("shows a card per step, marks the one in focus, and jumps there on click", () => {
    const s = stepper({ step: 1 });
    render(<DiagramReel steps={steps} stepper={s} />);
    const cards = screen.getAllByRole("button", { name: /→/ });
    expect(cards).toHaveLength(2);
    expect(cards[1].getAttribute("aria-current")).toBe("step");
    fireEvent.click(cards[0]);
    expect(s.goTo).toHaveBeenCalledWith(0);
  });

  it("opens the details row under the reel on a card click, and Close hides it", () => {
    const { container, rerender } = render(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} />);
    expect(container.querySelector(".dreel-detail")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /→/ })[0]);
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} />);
    const strip = container.querySelector(".dreel-strip");
    const detail = container.querySelector(".dreel-detail");
    expect(detail).not.toBeNull();
    // the row comes after the strip in the page flow, so it cannot shrink the diagram above
    expect(strip.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("holds the token")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(container.querySelector(".dreel-detail")).toBeNull();
  });

  it("shows a node's detail when the page passes one, and clears it on Close", () => {
    const onClear = vi.fn();
    render(<DiagramReel steps={steps} stepper={stepper()} nodeDetail={buildNodeDetail(nodes[1])} onClearNode={onClear} />);
    expect(screen.getByRole("heading", { name: "BFF" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("renders nothing without steps", () => {
    const { container } = render(<DiagramReel steps={[]} stepper={stepper()} />);
    expect(container.firstChild).toBeNull();
  });
});
