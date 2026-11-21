import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiagramReel from "../DiagramReel";
import { buildReelSteps } from "../../utils/diagramReel";

afterEach(cleanup);
const nodes = [{ id: "a", label: "Browser", sub: ["tab"] }, { id: "b", label: "Gateway", sub: ["door"] }];
const steps = buildReelSteps({ edges: [["a", "b", "first"], ["b", "a", "second"]], nodes });
const stepper = (over = {}) => ({ step: -1, goTo: vi.fn(), ...over });
const detail = () => screen.queryByTestId("diagram-reel-detail");

describe("DiagramReel follow: a side panel that follows the stepped message", () => {
  it("without follow, stepping alone opens nothing (as before)", () => {
    render(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} />);
    expect(detail()).toBeNull();
  });

  it("with follow, the panel shows the step in focus as soon as the walkthrough runs, and moves with it", () => {
    const { rerender } = render(<DiagramReel steps={steps} stepper={stepper({ step: -1 })} follow />);
    expect(detail()).toBeNull(); // not started: nothing to show
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} follow />);
    expect(detail()).toHaveTextContent("Browser → Gateway");
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: 1 })} follow />);
    expect(detail()).toHaveTextContent("Gateway → Browser");
  });

  it("Close hides it and it stays closed while the walkthrough steps on; stopping and starting again brings it back", () => {
    const { rerender } = render(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} follow />);
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(detail()).toBeNull();
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: 1 })} follow />);
    expect(detail()).toBeNull();
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: -1 })} follow />);
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} follow />);
    expect(detail()).not.toBeNull();
  });

  it("picking a card (or a message click) opens it again after a Close", () => {
    const s = stepper({ step: 0 });
    const { rerender } = render(<DiagramReel steps={steps} stepper={s} follow />);
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(detail()).toBeNull();
    fireEvent.click(document.querySelectorAll(".dreel-card")[1]);
    expect(s.goTo).toHaveBeenCalledWith(1);
    expect(detail()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    rerender(<DiagramReel steps={steps} stepper={stepper({ step: 1 })} follow openKey={1} />);
    expect(detail()).not.toBeNull();
  });

  it("a click on the card in focus closes the panel, and it stays closed", () => {
    render(<DiagramReel steps={steps} stepper={stepper({ step: 0 })} follow />);
    expect(detail()).not.toBeNull();
    fireEvent.click(document.querySelectorAll(".dreel-card")[0]);
    expect(detail()).toBeNull();
  });
});
