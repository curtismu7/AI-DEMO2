import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DemoTourProvider, useDemoTour } from "../../../context/DemoTourContext";
import DemoTourModal from "../DemoTourModal";

function Launch({ tour }) {
  const t = useDemoTour();
  return <button onClick={() => t.start(tour)}>launch</button>;
}

function renderTour(tour) {
  return render(
    <MemoryRouter>
      <DemoTourProvider>
        <Launch tour={tour} />
        <DemoTourModal />
      </DemoTourProvider>
    </MemoryRouter>,
  );
}

describe("DemoTourModal active-tour rendering", () => {
  it("shows the delegation tour intro when the delegation tour is started", () => {
    renderTour("delegation");
    fireEvent.click(screen.getByText("launch"));
    expect(screen.getByText(/Prove who's acting for me/i)).toBeInTheDocument();
  });

  it("shows the general tour intro when no tour key is given", () => {
    renderTour(undefined);
    fireEvent.click(screen.getByText("launch"));
    expect(screen.getByText(/AI Agent Security Demo/i)).toBeInTheDocument();
  });
});
