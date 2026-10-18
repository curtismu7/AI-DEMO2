import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ArchitectureTabsPanel from "../ArchitectureTabsPanel";
import { parseFlowchart } from "../../utils/parseFlowchart";
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

const MMD = readFileSync(resolve(process.cwd(), "public/architecture/architecture.mmd"), "utf8");

describe("ArchitectureTabsPanel diagram controls", () => {
  it("Full topology view draws architecture.mmd in React Flow: every node, draggable, Simulate, Reset, speed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ text: () => Promise.resolve(MMD) });
    const panel = openTab("System Architecture");
    const m = parseFlowchart(MMD);
    await expectDiagramControls(panel);
    // eslint-disable-next-line testing-library/no-node-access
    await waitFor(() => expect(panel.querySelectorAll(".react-flow__node")).toHaveLength(m.nodes.length + m.groups.length));
    expect(screen.queryByRole("img", { name: /Full banking demo architecture/ })).toBeNull();
    vi.restoreAllMocks();
  });

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
