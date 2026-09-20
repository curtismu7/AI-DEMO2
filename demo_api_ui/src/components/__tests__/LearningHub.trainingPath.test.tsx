import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import LearningHub from "../LearningHub";

vi.mock("../../context/ThemeContext", () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../LearningHubAgent", () => ({ default: () => null }));
vi.mock("../TokenChainTraceRail", () => ({ default: () => null }));

describe("LearningHub training path", () => {
  it("exposes the live customer story in sequence", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /secure one agent action from identity to evidence/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run agent gateway authorization/i })).toHaveAttribute(
      "href",
      "/agent-gateway-authorization",
    );
    expect(screen.getByRole("link", { name: /inspect token flow/i })).toHaveAttribute(
      "href",
      "/agent-flow-inspector",
    );
    expect(screen.getByRole("link", { name: /test authorize decisions/i })).toHaveAttribute(
      "href",
      "/pingone-authorize?tab=guided",
    );
    expect(screen.getByRole("link", { name: /open transaction trace/i })).toHaveAttribute(
      "href",
      "/transaction-trace",
    );
  });

  it("labels cards by execution status and searches protocol metadata", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <LearningHub />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /agent gateway authorization.*live/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /par \(rfc 9126\).*simulated/i })).toBeInTheDocument();
    expect(screen.getAllByText("REFERENCE", { exact: true }).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("textbox", { name: /search learning topics/i }), {
      target: { value: "RFC 8693" },
    });
    expect(screen.getByRole("button", { name: /token exchange \(rfc 8693\)/i })).toBeInTheDocument();
    expect(screen.getByText(/live or configured/i)).toBeInTheDocument();
  });

  it("routes simulated topics to a runnable lab", () => {
    render(
      <MemoryRouter initialEntries={["/learning"]}>
        <Routes>
          <Route path="/learning" element={<LearningHub />} />
          <Route path="/learning-lab/:lab" element={<div>Runnable protocol lab</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /rar \(rfc 9396\).*simulated/i }));
    expect(screen.getByText("Runnable protocol lab")).toBeInTheDocument();
  });
});
