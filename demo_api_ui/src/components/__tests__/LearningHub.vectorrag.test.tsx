import React from "react";
import { render, screen } from "@testing-library/react";
import LearningHub from "../LearningHub";

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));

test("Learning Hub lists the Weaviate vector-search card", () => {
  render(<LearningHub />);
  expect(
    screen.getByText(/Vector Search & RAG \(Weaviate\)/i)
  ).toBeInTheDocument();
});
