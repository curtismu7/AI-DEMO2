import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DiagramControls from "../diagram/DiagramControls";

/**
 * The shared step toolbar from the keyboard. Wave 2 reported that Simulate did not start on Enter on
 * /privilege-map; in the real browser Enter and Space both start it, so those two cases pin that. What did
 * reproduce: pressing Simulate, Pause, Resume or Stop swaps the focused button for a different one, so focus
 * fell to <body> and the next Tab began at the top of the page. Focus now follows the control that took over.
 */
function Harness({ total = 3 }) {
  const [state, setState] = useState({ active: false, paused: false, step: 0 });
  return (
    <DiagramControls
      currentStep={state.step + 1}
      totalSteps={total}
      isSimulating={state.active}
      isPaused={state.paused}
      onSimulate={() => setState({ active: true, paused: false, step: 0 })}
      onPrev={() => setState((s) => ({ ...s, step: Math.max(0, s.step - 1) }))}
      onPause={() => setState((s) => ({ ...s, paused: true }))}
      onResume={() => setState((s) => ({ ...s, paused: false }))}
      onNext={() => setState((s) => ({ ...s, step: Math.min(total - 1, s.step + 1) }))}
      onStop={() => setState({ active: false, paused: false, step: 0 })}
    />
  );
}

const simulate = () => screen.getByRole("button", { name: "Simulate" });

describe("DiagramControls from the keyboard", () => {
  it("Enter on a focused Simulate starts the walkthrough", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    simulate().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Simulate" })).toBeNull();
  });

  it("Space on a focused Simulate starts the walkthrough", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    simulate().focus();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("keeps focus in the toolbar through Simulate, Pause, Resume and Stop", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    simulate().focus();

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Resume" }));

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));

    screen.getByRole("button", { name: "Stop" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(simulate());
  });

  it("does not steal focus when the walkthrough changes without a toolbar press", () => {
    const { rerender } = render(
      <DiagramControls currentStep={1} totalSteps={3} isSimulating={false} onSimulate={() => {}} />,
    );
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    rerender(
      <DiagramControls currentStep={1} totalSteps={3} isSimulating isPaused={false} onPause={() => {}} onStop={() => {}} />,
    );
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
