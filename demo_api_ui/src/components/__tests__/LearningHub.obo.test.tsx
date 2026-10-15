import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LearningHub from "../LearningHub";
import { SessionTokenProvider } from "../../context/SessionTokenContext";

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
  useEducationUIOptional: () => ({ open: vi.fn() }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));

test("Learning Hub lists the OBO lesson and opens /obo-demo", () => {
  render(
    <SessionTokenProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LearningHub />} />
          <Route path="/obo-demo" element={<div>obo-demo-probe</div>} />
        </Routes>
      </MemoryRouter>
    </SessionTokenProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /On behalf of the user \(OBO\)/i }));
  expect(screen.getByText("obo-demo-probe")).toBeInTheDocument();
});
