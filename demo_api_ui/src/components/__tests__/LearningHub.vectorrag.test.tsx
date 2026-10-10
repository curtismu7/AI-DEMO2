import React from "react";
import { render, screen } from "@testing-library/react";
import LearningHub from "../LearningHub";
import { SessionTokenProvider } from "../../context/SessionTokenContext";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
  useEducationUIOptional: () => ({ open: vi.fn() }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));

test("Learning Hub lists the Weaviate vector-search card", () => {
  render(<SessionTokenProvider><MemoryRouter><LearningHub /></MemoryRouter></SessionTokenProvider>);
  expect(
    screen.getByText(/Vector Search & RAG \(Weaviate\)/i)
  ).toBeInTheDocument();
});

test("Learning Hub lists the Shadow AI Detector web page", () => {
  render(<SessionTokenProvider><MemoryRouter><LearningHub /></MemoryRouter></SessionTokenProvider>);
  expect(screen.getByRole("button", { name: /Shadow AI Detector/i })).toBeInTheDocument();
});
