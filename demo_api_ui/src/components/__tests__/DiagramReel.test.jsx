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

  it("puts focus back on the card in focus when Close removes the details row (never on the body)", () => {
    const { container } = render(<DiagramReel steps={steps} stepper={stepper({ step: 1 })} />);
    const cards = screen.getAllByRole("button", { name: /→/ });
    cards[1].focus();
    fireEvent.click(cards[1]);
    const close = screen.getByRole("button", { name: "Close details" });
    close.focus();
    fireEvent.click(close);
    expect(container.querySelector(".dreel-detail")).toBeNull();
    expect(document.activeElement).toBe(cards[1]);
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

describe("DiagramReel details: JSON colour and font size", () => {
  const jsonNodes = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  const nodeDetail = { title: "T", lines: [{ who: "Token", code: 'Header line\n{\n  "iss": "https://x",\n  "exp": 3600,\n  "ok": true\n}' }] };
  const stepper = { step: -1, goTo: vi.fn() };
  const steps = buildReelSteps({ edges: [["a", "b", "x"]], nodes: jsonNodes });

  it("colours JSON keys, strings, numbers and literals without changing the text", () => {
    const { container } = render(<DiagramReel steps={steps} stepper={stepper} nodeDetail={nodeDetail} />);
    expect(container.querySelector(".dreel-json-key").textContent).toBe('"iss"');
    expect(container.querySelector(".dreel-json-str").textContent).toBe('"https://x"');
    expect(container.querySelector(".dreel-json-num").textContent).toBe("3600");
    expect(container.querySelector(".dreel-json-lit").textContent).toBe("true");
    expect(container.querySelector(".dreel-code").textContent).toBe(nodeDetail.lines[0].code);
  });

  it("changes the details font size from the A-/A/A+ buttons", () => {
    const { container } = render(<DiagramReel steps={steps} stepper={stepper} nodeDetail={nodeDetail} />);
    const detail = container.querySelector(".dreel-detail");
    expect(detail.dataset.fontSize).toBe("medium");
    fireEvent.click(screen.getByLabelText("Increase details font size"));
    expect(detail.dataset.fontSize).toBe("large");
    fireEvent.click(screen.getByLabelText("Decrease details font size"));
    expect(detail.dataset.fontSize).toBe("small");
  });
});
