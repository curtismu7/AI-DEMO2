import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import LearningHub from "../LearningHub";
import { EDU } from "../education/educationIds";
import { MemoryRouter } from "react-router-dom";

const { openEdu } = vi.hoisted(() => ({ openEdu: vi.fn() }));

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: openEdu }),
  useEducationUIOptional: () => ({ open: openEdu }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));

test("Learning Hub lists the SPIFFE / SVID card", () => {
  render(<MemoryRouter><LearningHub /></MemoryRouter>);
  expect(
    screen.getByText(/SPIFFE \/ SVID Workload Identity/i),
  ).toBeInTheDocument();
});

test("clicking the SPIFFE card opens the SPIFFE education panel", () => {
  // The card rendering is not enough — an item missing from categoryActionMap
  // still renders but does nothing when clicked.
  openEdu.mockClear();
  render(<MemoryRouter><LearningHub /></MemoryRouter>);

  fireEvent.click(
    screen.getByRole("button", { name: /SPIFFE \/ SVID Workload Identity/i }),
  );

  expect(openEdu).toHaveBeenCalledWith(EDU.SPIFFE, "what");
});
