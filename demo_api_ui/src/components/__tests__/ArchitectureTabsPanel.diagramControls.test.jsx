import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ArchitectureTabsPanel from "../ArchitectureTabsPanel";
import { expectDiagramControls, ResizeObserverStub } from "./diagramControlsHelpers";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: { get: vi.fn(() => Promise.resolve({ data: { diagrams: [] } })), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock("../NarrativePanel", () => ({ default: () => null }));
vi.mock("../../context/ExchangeModeContext", () => ({
  useExchangeMode: () => ({ mode: "double", setMode: vi.fn() }),
}));

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

function openTab(name) {
  render(
    <MemoryRouter initialEntries={["/architecture/system"]}>
      <ArchitectureTabsPanel />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("tab", { name }));
  return document.getElementById(
    { "System Architecture": "arch-content", "Token Exchange Flow": "flow-content", "CIBA Step-Up": "ciba-stepup-content" }[name],
  );
}

describe("ArchitectureTabsPanel diagram controls", () => {
  it("Live token highlights view: Simulate, Reset, speed, draggable", async () => {
    const panel = openTab("System Architecture");
    fireEvent.click(screen.getByRole("tab", { name: /Live token highlights/ }));
    await expectDiagramControls(panel);
  });

  it("Token Exchange Flow tab: Simulate, Reset, speed, draggable", async () => {
    await expectDiagramControls(openTab("Token Exchange Flow"));
  });

  it("CIBA Step-Up tab keeps its text and embeds the CIBA link diagram with controls", async () => {
    const panel = openTab("CIBA Step-Up");
    screen.getByText("High-value transfer attempt");
    await expectDiagramControls(panel);
  });
});
