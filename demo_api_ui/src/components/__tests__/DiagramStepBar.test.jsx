import { fireEvent, render, screen } from "@testing-library/react";
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
});
