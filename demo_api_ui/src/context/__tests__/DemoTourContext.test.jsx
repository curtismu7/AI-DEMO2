import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DemoTourProvider,
  useDemoTour,
  DELEGATION_TOUR_STEPS,
  TOUR_STEPS,
} from "../DemoTourContext";

function Probe() {
  const t = useDemoTour();
  return (
    <div>
      <span data-testid="total">{t.total}</span>
      <span data-testid="title">{t.steps[t.step]?.title}</span>
      <button onClick={() => t.start("delegation")}>deleg</button>
      <button onClick={() => t.start()}>gen</button>
    </div>
  );
}

describe("DELEGATION_TOUR_STEPS", () => {
  it("has the 4-stage arc (intro + 4 stages) pointing at real routes", () => {
    expect(DELEGATION_TOUR_STEPS).toHaveLength(5);
    expect(DELEGATION_TOUR_STEPS[0].title).toMatch(/Prove who/i);
    expect(DELEGATION_TOUR_STEPS[1].title).toMatch(/Family/i);
    expect(DELEGATION_TOUR_STEPS[1].action.route).toBe("/delegation");
    expect(DELEGATION_TOUR_STEPS[4].title).toMatch(/Workforce/i);
  });
});

describe("DemoTourProvider multi-tour", () => {
  it("defaults to the general tour and switches to the delegation tour", () => {
    render(
      <DemoTourProvider>
        <Probe />
      </DemoTourProvider>,
    );
    expect(screen.getByTestId("total").textContent).toBe(String(TOUR_STEPS.length));
    fireEvent.click(screen.getByText("deleg"));
    expect(screen.getByTestId("total").textContent).toBe(String(DELEGATION_TOUR_STEPS.length));
    expect(screen.getByTestId("title").textContent).toMatch(/Prove who/i);
    fireEvent.click(screen.getByText("gen"));
    expect(screen.getByTestId("total").textContent).toBe(String(TOUR_STEPS.length));
  });
});
