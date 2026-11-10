import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DiagramStepBar from "../DiagramStepBar";

const stepper = (over = {}) => ({
  step: -1,
  total: 5,
  active: false,
  paused: false,
  stepMs: 2500,
  setStepMs: vi.fn(),
  simulate: vi.fn(),
  resume: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  ...over,
});

describe("DiagramStepBar", () => {
  it("has a Reset button that is off until a walkthrough is running, then clears it", () => {
    const idle = stepper();
    const { rerender } = render(<DiagramStepBar stepper={idle} caption="" />);
    expect(screen.getByRole("button", { name: "Reset" }).disabled).toBe(true);

    const running = stepper({ step: 2, active: true, paused: true });
    rerender(<DiagramStepBar stepper={running} caption="A → B" />);
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(running.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Step 3 of 5/)).toBeTruthy();
  });

  it("renders nothing when there is nothing to walk", () => {
    const { container } = render(<DiagramStepBar stepper={stepper({ total: 0 })} caption="" />);
    expect(container.firstChild).toBeNull();
  });

  it("names its toolbar when given a label, so a page with several diagrams has distinguishable controls", () => {
    const { rerender } = render(<DiagramStepBar stepper={stepper()} caption="" />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    rerender(<DiagramStepBar stepper={stepper()} caption="" label="Simulated replay controls" />);
    expect(screen.getByRole("toolbar", { name: "Simulated replay controls" })).toBeInTheDocument();
  });

  describe("several bars on one page", () => {
    const simulates = (root = document) => [...root.querySelectorAll(".dc-ctrl-btn--simulate")];

    it("a lone bar is unchanged: not marked multi, no toolbar role", () => {
      render(<DiagramStepBar stepper={stepper()} caption="" />);
      expect(screen.getByTestId("diagram-step-bar")).not.toHaveAttribute("data-multi");
      expect(screen.queryByRole("toolbar")).toBeNull();
    });

    it("two bars are both marked multi (so neither is a primary) and get distinct toolbar names", () => {
      render(
        <>
          <DiagramStepBar stepper={stepper()} caption="" testId="a" />
          <DiagramStepBar stepper={stepper()} caption="" testId="b" />
        </>,
      );
      expect(simulates()).toHaveLength(2);
      expect(screen.getByTestId("a")).toHaveAttribute("data-multi", "true");
      expect(screen.getByTestId("b")).toHaveAttribute("data-multi", "true");
      const one = screen.getByRole("toolbar", { name: "Diagram 1 controls" });
      const two = screen.getByRole("toolbar", { name: "Diagram 2 controls" });
      // the same-named Simulate buttons are now told apart by their toolbar
      expect(within(one).getByRole("button", { name: "Simulate" })).not.toBe(within(two).getByRole("button", { name: "Simulate" }));
    });

    it("an explicit label wins over the numbered name", () => {
      render(
        <>
          <DiagramStepBar stepper={stepper()} caption="" testId="a" label="Gateway controls" />
          <DiagramStepBar stepper={stepper()} caption="" testId="b" />
        </>,
      );
      expect(screen.getByRole("toolbar", { name: "Gateway controls" })).toBeInTheDocument();
      expect(screen.getByRole("toolbar", { name: "Diagram 2 controls" })).toBeInTheDocument();
    });

    it("a bar with nothing to walk does not count, and removing one bar puts the other back to a lone bar", () => {
      const { rerender } = render(
        <>
          <DiagramStepBar stepper={stepper()} caption="" testId="a" />
          <DiagramStepBar stepper={stepper({ total: 0 })} caption="" testId="empty" />
        </>,
      );
      expect(screen.getByTestId("a")).not.toHaveAttribute("data-multi");
      rerender(
        <>
          <DiagramStepBar stepper={stepper()} caption="" testId="a" />
          <DiagramStepBar stepper={stepper()} caption="" testId="b" />
        </>,
      );
      expect(screen.getByTestId("a")).toHaveAttribute("data-multi", "true");
      rerender(<DiagramStepBar stepper={stepper()} caption="" testId="a" />);
      expect(screen.getByTestId("a")).not.toHaveAttribute("data-multi");
      expect(screen.queryByRole("toolbar")).toBeNull();
    });

    it("the multi rules make every step button a bordered secondary on tokens (no Ping Red fill, no literal colour)", () => {
      const css = readFileSync(resolve(__dirname, "..", "DiagramStepBar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
      const block = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      const base = block('.dstep-bar[data-multi="true"] .dc-toolbar .dc-ctrl-btn');
      expect(base).toMatch(/border:\s*1px solid var\(--control-border\)/);
      expect(base).toMatch(/background:\s*var\(--th-bg-card\)/);
      expect(base).toMatch(/color:\s*var\(--th-text\)/);
      expect(base).not.toMatch(/#[0-9a-f]{3,8}\b|gradient\(/i);
      // the base rule it overrides (specificity 0,1,0) is beaten by 0,4,0
      expect(readFileSync(resolve(__dirname, "..", "diagram", "DiagramControls.css"), "utf8")).toMatch(/\.dc-ctrl-btn--simulate\s*\{[^}]*#d20e0f/);
    });
  });
});
